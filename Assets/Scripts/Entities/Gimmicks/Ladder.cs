using UnityEngine;

namespace RunToExit.Core
{
    public class Ladder : MonoBehaviour, IGridEntity
    {
        public Vector2Int GridPosition { get; private set; }

        public void InitializePosition()
        {
            GridPosition = new Vector2Int(Mathf.RoundToInt(transform.position.x), Mathf.RoundToInt(transform.position.y));
        }

        public bool IsSolidTo(CharacterBase character)
        {
            // ハシゴ自体は壁（障害物）ではない
            return false;
        }

        public bool IsInteractable { get; } = false;

        public void OnInteract(CharacterBase character)
        {
        }

        private void Start()
        {
            InitializePosition();
            GridManager.Instance.AddEntity(this);
        }

        private void OnDestroy()
        {
            if (GridManager.Instance != null)
            {
                GridManager.Instance.RemoveEntity(this);
            }
        }
    }
}
