using System.Collections;
using UnityEngine;
using UnityEngine.InputSystem;

public class PlayerController : MonoBehaviour
{
    public float moveSpeed = 5f;
    private bool isMoving = false;

    void Update()
    {
        if (isMoving) return;
        float inputX = 0f;
        float inputY = 0f;

        if (Keyboard.current != null)
        {
            if (Keyboard.current.rightArrowKey.isPressed || Keyboard.current.dKey.isPressed) inputX = 1f;
            else if (Keyboard.current.leftArrowKey.isPressed || Keyboard.current.aKey.isPressed) inputX = -1f;
            
            if (Keyboard.current.upArrowKey.isPressed || Keyboard.current.wKey.isPressed) inputY = 1f;
            else if (Keyboard.current.downArrowKey.isPressed || Keyboard.current.sKey.isPressed) inputY = -1f;
        }

        if (inputX != 0)
        {
            StartCoroutine(MoveToGrid(new Vector3(inputX, 0, 0)));
        }
        else if (inputY != 0)
        {
            StartCoroutine(MoveToGrid(new Vector3(0, inputY, 0)));
        }
    }

    private IEnumerator MoveToGrid(Vector3 direction)
    {
        isMoving = true;
        Vector3 targetPosition = transform.position + direction;

        // プレイヤーは縦2マスなので、進む先の「足元」と「頭上(+1のY座標)」の2箇所をチェックする
        Vector2 footPos = targetPosition;
        Vector2 headPos = targetPosition + Vector3.up; 

        // 足元と頭上のどちらかに障害物がないか調べる
        Collider2D hitFoot = Physics2D.OverlapPoint(footPos);
        Collider2D hitHead = Physics2D.OverlapPoint(headPos);

        // 自分自身（PlayerのCollider）を検知した場合は無視するための処理
        if (hitFoot != null && hitFoot.gameObject == this.gameObject) hitFoot = null;
        if (hitHead != null && hitHead.gameObject == this.gameObject) hitHead = null;

        // 何かにぶつかった場合の判定
        if (hitFoot != null || hitHead != null)
        {
            // ぶつかった対象が「壁（Wallタグ）」なら移動キャンセル
            if ((hitFoot != null && hitFoot.CompareTag("Wall")) || 
                (hitHead != null && hitHead.CompareTag("Wall")))
            {
                yield break; // コルーチンを終了して移動しない
            }

            // ぶつかった対象が「木箱」の場合
            MovableBox box = null;
            if (hitFoot != null) box = hitFoot.GetComponent<MovableBox>();
            if (hitHead != null && box == null) box = hitHead.GetComponent<MovableBox>();

            if (box != null)
            {
                // 木箱の先のマスが空いているか確認
                if (box.CanMove(direction))
                {
                    box.Push(direction); // 木箱を1マス動かす
                }
                else
                {
                    // 木箱が動かせない（奥が壁など）なら、プレイヤーも進めない
                    yield break; 
                }
            }
        }

        while (Vector3.Distance(transform.position, targetPosition) > 0.01f)
        {
            transform.position = Vector3.MoveTowards(transform.position, targetPosition, moveSpeed * Time.deltaTime);
            yield return null;
        }

        transform.position = targetPosition;
        isMoving = false;

        
        // === 障害物チェックここまで ===

        // 障害物がなければ（または箱を押し込めたら）、自身の移動を開始する
        while (Vector3.Distance(transform.position, targetPosition) > 0.01f)
        {
            transform.position = Vector3.MoveTowards(transform.position, targetPosition, moveSpeed * Time.deltaTime);
            yield return null;
        }

        transform.position = targetPosition;
    }
}

        
