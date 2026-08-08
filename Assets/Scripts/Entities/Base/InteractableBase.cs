using UnityEngine;

namespace RunToExit.Core
{
    public abstract class InteractableBase : MonoBehaviour, IGridEntity
    {
        public Vector2Int GridPosition => new Vector2Int(Mathf.RoundToInt(transform.position.x), Mathf.RoundToInt(transform.position.y));

        public bool IsInteractable => true;

        public virtual bool IsSolidTo(CharacterBase character)
        {
            return IsObstacle(character);
        }

        protected virtual void Start()
        {
            RunToExit.Map.GridManager.Instance.AddEntity(this);
        }

        protected virtual void OnDestroy()
        {
            if (RunToExit.Map.GridManager.Instance != null)
            {
                RunToExit.Map.GridManager.Instance.RemoveEntity(this);
            }
        }

        // 障害物かどうか（通行をブロックするか）
        public virtual bool IsObstacle(CharacterBase character) => false;

        // キャラクターがこのオブジェクトに対してアクションを起こした時の処理
        public abstract void OnInteract(CharacterBase character);
    }
}
