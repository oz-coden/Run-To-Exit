using System.Collections;
using UnityEngine;

namespace RunToExit.Core
{
    public abstract class CharacterBase : MonoBehaviour
    {
        [Header("Character Stats")]
        public int Power = 1;
        public float MoveSpeed = 5f;
        public int ClimbLimit = 3;

        protected bool isMoving = false;
        
        // 落下中などの特殊状態
        protected bool isFalling = false;

        public Vector2Int GridPosition => new Vector2Int(Mathf.RoundToInt(transform.position.x), Mathf.RoundToInt(transform.position.y));

        // キャラクターは2マスサイズ（足元と頭上）
        public virtual bool CanMoveTo(Vector2Int targetPos, out MovableBox pushableBox)
        {
            pushableBox = null;
            Vector2Int footPos = targetPos;
            Vector2Int headPos = targetPos + Vector2Int.up;

            Collider2D hitFoot = GridManager.Instance.GetObjectAt(footPos);
            Collider2D hitHead = GridManager.Instance.GetObjectAt(headPos);

            // 自分自身は無視
            if (hitFoot != null && hitFoot.gameObject == gameObject) hitFoot = null;
            if (hitHead != null && hitHead.gameObject == gameObject) hitHead = null;

            if (hitFoot == null && hitHead == null) return true; // 空いている

            // 壁チェック
            if ((hitFoot != null && hitFoot.CompareTag("Wall")) || 
                (hitHead != null && hitHead.CompareTag("Wall")))
            {
                return false;
            }

            // 箱チェック
            if (hitFoot != null) pushableBox = hitFoot.GetComponent<MovableBox>();
            if (hitHead != null && pushableBox == null) pushableBox = hitHead.GetComponent<MovableBox>();

            if (pushableBox != null)
            {
                // 自分のパワーで箱を押せるか？（箱の先のマスが空いているかもチェック）
                if (Power >= pushableBox.RequiredPower && pushableBox.CanMoveTo(targetPos + (targetPos - GridPosition)))
                {
                    return true;
                }
                return false;
            }

            // 他の障害物（NPCなど）が居る場合も進めない
            if (hitFoot != null || hitHead != null) return false;

            return true;
        }

        protected IEnumerator MoveRoutine(Vector2Int targetPos, MovableBox boxToPush = null)
        {
            isMoving = true;

            if (boxToPush != null)
            {
                Vector2Int boxTarget = targetPos + (targetPos - GridPosition);
                boxToPush.PushTo(boxTarget);
            }

            Vector3 endPos = new Vector3(targetPos.x, targetPos.y, 0);
            while (Vector3.Distance(transform.position, endPos) > 0.01f)
            {
                transform.position = Vector3.MoveTowards(transform.position, endPos, MoveSpeed * Time.deltaTime);
                yield return null;
            }
            transform.position = endPos;
            isMoving = false;

            CheckFall();
        }

        protected virtual void CheckFall()
        {
            // 足元の1マス下の確認
            Vector2Int below = GridPosition + Vector2Int.down;
            Collider2D hit = GridManager.Instance.GetObjectAt(below);
            
            // 下に何もない場合は落下
            if (hit == null)
            {
                StartCoroutine(FallRoutine());
            }
        }

        protected IEnumerator FallRoutine()
        {
            isMoving = true;
            isFalling = true;
            
            while (true)
            {
                Vector2Int below = GridPosition + Vector2Int.down;
                Collider2D hit = GridManager.Instance.GetObjectAt(below);
                
                // 着地判定（壁か箱などに乗る）
                if (hit != null && hit.gameObject != gameObject)
                {
                    break;
                }
                
                Vector3 endPos = transform.position + Vector3.down;
                while (Vector3.Distance(transform.position, endPos) > 0.01f)
                {
                    transform.position = Vector3.MoveTowards(transform.position, endPos, MoveSpeed * 1.5f * Time.deltaTime);
                    yield return null;
                }
                transform.position = endPos;
            }
            
            isMoving = false;
            isFalling = false;
        }
    }
}
